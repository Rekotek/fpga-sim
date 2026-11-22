// Тестбенч урока 6, шаг 3: три нажатия S1, сброс S2, S1 при нажатой S2, снова S1.
// Обе кнопки дребезжат. Задача move «двигает» кнопку с дребезгом.
`timescale 1ns / 100ps

module tb_top;
    localparam integer BOUNCE = 3;    // сколько раз контакт дребезжит

    reg        clk = 1'b0;
    reg  [1:0] btn = 2'b00;           // btn[0] = S1, btn[1] = S2
    wire [5:0] led;

    always #18.5 clk = ~clk;          // период 37 нс, как 27 МГц

    // CLK_HZ = 1000: один такт = «1 мс», антидребезг опрашивает раз в 10 тактов.
    top #(.CLK_HZ(1000)) dut (.clk(clk), .btn_s1(btn[0]), .btn_s2(btn[1]), .led(led));

    wire [5:0] count = ~led;          // что показывают светодиоды
    integer    n, errors = 0;

    // Перевести кнопку i в положение v (1 = нажата) с дребезгом и подождать.
    task move (input integer i, input v);
        integer k;
        begin
            for (k = 0; k < BOUNCE; k = k + 1) begin
                btn[i] = v;   #60;    // контакт встал в новое положение...
                btn[i] = ~v;  #40;    // ...и отскочил обратно
            end
            btn[i] = v;  #1500;       // наконец успокоился; ждём «40 мс»
        end
    endtask

    // Проверить, что светодиоды показывают want.
    task check (input [5:0] want);
        begin
            $display("   %2d      %2d", count, want);
            if (count !== want) errors = errors + 1;
        end
    endtask

    initial begin
        $dumpfile("tb_top.vcd");
        $dumpvars(0, tb_top);
        $display("что делаем               счёт  ожидали");

        #100;
        for (n = 1; n <= 3; n = n + 1) begin
            move(0, 1'b1);  move(0, 1'b0);
            $write("S1 нажали и отпустили");  check(n);
        end
        move(1, 1'b1);                        $write("S2 нажали и держим   ");  check(0);
        move(0, 1'b1);  move(0, 1'b0);        $write("S1 при нажатой S2    ");  check(0);
        move(1, 1'b0);                        $write("S2 отпустили         ");  check(0);
        move(0, 1'b1);  move(0, 1'b0);        $write("S1 нажали и отпустили");  check(1);

        if (errors == 0) $display("ТЕСТ ПРОЙДЕН");
        else             $display("ТЕСТ НЕ ПРОЙДЕН: ошибок %0d", errors);
        $finish;
    end
endmodule
