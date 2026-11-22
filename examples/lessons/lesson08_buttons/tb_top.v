// Тестбенч урока 8: яркость кнопками. Жмём S1 и S2 (с дребезгом, task move
// из урока 6), после каждой серии нажатий проверяем уровень и считаем,
// сколько тактов из 256 (один период ШИМ) горит LED0.
`timescale 1ns / 100ps

module tb_top;
    localparam integer BOUNCE = 3;    // сколько раз контакт дребезжит

    reg        clk = 1'b0;
    reg  [1:0] btn = 2'b00;           // btn[0] = S1, btn[1] = S2
    wire [5:0] led;

    always #18.5 clk = ~clk;          // период 37 нс, как 27 МГц

    // CLK_HZ = 1000: один такт = «1 мс», антидребезг опрашивает раз в 10 тактов.
    top #(.CLK_HZ(1000)) dut (.clk(clk), .btn_s1(btn[0]), .btn_s2(btn[1]), .led(led));

    wire [3:0] level = ~led[4:1];     // номер уровня на LED1..LED4
    integer    n, errors = 0;

    // Перевести кнопку i в положение v (1 = нажата) с дребезгом и подождать.
    task move (input integer i, input v);
        integer k;
        begin
            for (k = 0; k < BOUNCE; k = k + 1) begin
                btn[i] = v;   #60;
                btn[i] = ~v;  #40;
            end
            btn[i] = v;  #1500;
        end
    endtask

    // Нажать и отпустить кнопку i (0 = S1, 1 = S2) n раз подряд.
    task press (input integer i, input integer times);
        integer k;
        begin
            for (k = 0; k < times; k = k + 1) begin
                move(i, 1'b1);  move(i, 1'b0);
            end
        end
    endtask

    // Проверить уровень и сосчитать, сколько тактов из 256 горит LED0.
    task check (input [3:0] want);
        integer t, ones;
        begin
            ones = 0;
            for (t = 0; t < 256; t = t + 1) begin
                @(negedge clk);
                if (led[0] == 1'b0) ones = ones + 1;    // горит при 0
            end
            $display("%7d %7d %12d %7d", level, want, ones, want * 17);
            if (level !== want || ones != want * 17) errors = errors + 1;
        end
    endtask

    initial begin
        $dumpfile("tb_top.vcd");
        $dumpvars(0, tb_top);
        $display("что делаем     уровень ожидали горел из 256 ожидали");
        #100;
        $write("после прошивки ");  check(8);
        press(0, 3);   $write("S1 × 3         ");  check(11);
        press(0, 6);   $write("S1 × 6         ");  check(15);   // упёрлись в 15
        press(1, 16);  $write("S2 × 16        ");  check(0);    // упёрлись в 0
        press(1, 2);   $write("S2 × 2         ");  check(0);
        press(0, 1);   $write("S1 × 1         ");  check(1);

        if (errors == 0) $display("ТЕСТ ПРОЙДЕН");
        else             $display("ТЕСТ НЕ ПРОЙДЕН: ошибок %0d", errors);
        $finish;
    end
endmodule
