// Тестбенч урока 6: три нажатия S1 — счётчик должен показать 1, 2, 3.
// BOUNCE — сколько раз контакт «дребезжит» при нажатии и при отпускании.
`timescale 1ns / 100ps

module tb_top;
    localparam integer BOUNCE = 3;    // занятие 1: 0 (чистая кнопка); занятие 2: 3

    reg        clk = 1'b0;
    reg        btn = 1'b0;            // «кнопка» в руках тестбенча
    wire [5:0] led;

    always #18.5 clk = ~clk;          // период 37 нс, как 27 МГц

    // CLK_HZ = 1000: в модели один такт = «1 мс». Антидребезг (занятие 2)
    // опрашивает кнопку раз в 10 тактов.
    top #(.CLK_HZ(1000)) dut (.clk(clk), .btn_s1(btn), .led(led));

    wire [5:0] count = ~led;          // что показывают светодиоды (1 = горит)
    integer    n, k, errors = 0;

    initial begin
        $dumpfile("tb_top.vcd");
        $dumpvars(0, tb_top);
        $display("нажатие  счёт  ожидали");

        #100;                                   // кнопка отпущена, всё успокоилось
        for (n = 1; n <= 3; n = n + 1) begin
            // Нажатие: контакт несколько раз замыкается и размыкается.
            for (k = 0; k < BOUNCE; k = k + 1) begin
                btn = 1'b1;  #60;               // замкнулся на 60 нс
                btn = 1'b0;  #40;               // и снова разомкнулся
            end
            btn = 1'b1;  #1500;                 // держим кнопку («40 мс»)
            // Отпускание: тот же дребезг.
            for (k = 0; k < BOUNCE; k = k + 1) begin
                btn = 1'b0;  #60;               // разомкнулся
                btn = 1'b1;  #40;               // и снова замкнулся
            end
            btn = 1'b0;  #1500;                 // отпустили и ждём
            $display("   %0d      %2d      %2d", n, count, n);
            if (count !== n) errors = errors + 1;
        end

        if (errors == 0) $display("ТЕСТ ПРОЙДЕН");
        else             $display("ТЕСТ НЕ ПРОЙДЕН: ошибок %0d", errors);
        $finish;
    end
endmodule
